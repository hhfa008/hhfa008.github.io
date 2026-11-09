#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'cron-explainer';
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
var START = { y: 2026, m: 11, d: 9, h: 10, min: 33 };

function runs(expr, from, count) {
  var parsed = engine.parseCron(expr);
  if (!parsed.ok) return parsed;
  return engine.nextRuns(parsed, from || START, count || 1);
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
  var p = engine.parseCron('*/5 * * * *');
  t.ok('parses every-five-minutes', p.ok);
  t.eq('minute values', p.fields.minute, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  t.eq('full hour range', p.fields.hour.length, 24);
  t.eq('both day fields unrestricted', [p.domAny, p.dowAny], [true, true]);

  t.eq('range list', engine.parseCron('0 9 * * 1-5').fields.dow, [1, 2, 3, 4, 5]);
  t.eq('comma list', engine.parseCron('0,30 * * * *').fields.minute, [0, 30]);
  t.eq('a/n means from a to max', engine.parseCron('5/10 * * * *').fields.minute,
    [5, 15, 25, 35, 45, 55]);
  t.eq('step inside range', engine.parseCron('0 1-10/3 * * *').fields.hour, [1, 4, 7, 10]);
  t.eq('weekday 7 normalizes to Sunday', engine.parseCron('0 0 * * 7').fields.dow, [0]);

  t.eq('wrong field count', engine.parseCron('* * *'), { ok: false, error: 'bad_field_count' });
  t.eq('empty expression', engine.parseCron('  '), { ok: false, error: 'empty_input' });
  t.eq('non-string expression', engine.parseCron(5), { ok: false, error: 'bad_value' });
  t.eq('out of range minute', engine.parseCron('60 * * * *'),
    { ok: false, error: 'out_of_range', field: 'minute' });
  t.eq('zero step rejected', engine.parseCron('*/0 * * * *'),
    { ok: false, error: 'bad_step', field: 'minute' });
  t.eq('reversed range rejected', engine.parseCron('10-5 * * * *'),
    { ok: false, error: 'bad_range', field: 'minute' });
  t.eq('garbage field rejected', engine.parseCron('abc * * * *'),
    { ok: false, error: 'bad_field', field: 'minute' });

  var d = engine.describe(engine.parseCron('*/15 8-18 * * *'));
  t.eq('describe minute step', [d.minute.type, d.minute.step], ['step', 15]);
  t.eq('describe hour list', d.hour.type, 'list');
  t.eq('describe weekday every', engine.describe(engine.parseCron('0 0 * * *')).dow.type, 'every');
  t.eq('describe conflict flag', engine.describe(engine.parseCron('0 0 1 * 1')).conflict, true);

  t.eq('next five-minute run is strictly later', runs('*/5 * * * *', START).runs[0],
    { y: 2026, m: 11, d: 9, h: 10, min: 35, ordinal: 29903675 });
  t.eq('exact minute still advances', runs('*/5 * * * *', { y: 2026, m: 11, d: 9, h: 10, min: 35 }).runs[0].min, 40);
  t.eq('midnight rollover', runs('0 0 * * *', START).runs[0],
    { y: 2026, m: 11, d: 10, h: 0, min: 0, ordinal: 29904480 });

  var work = runs('0 9 * * 1-5', { y: 2026, m: 11, d: 13, h: 10, min: 0 }, 3);
  t.eq('weekday schedule skips weekend', work.runs.map(function (r) { return r.d; }), [16, 17, 18]);

  var leap = runs('0 0 29 2 *', { y: 2026, m: 11, d: 9, h: 10, min: 0 }, 2);
  t.eq('leap day years', leap.runs.map(function (r) { return r.y; }), [2028, 2032]);

  var monthEnd = runs('0 0 31 * *', START, 1);
  t.eq('31st skips short months', [monthEnd.runs[0].m, monthEnd.runs[0].d], [12, 31]);

  t.eq('impossible date reports no match', runs('0 0 31 2 *', START, 1), { ok: false, error: 'no_match' });

  var orRuns = runs('0 0 1 * 1', START, 3);
  t.eq('day/hour OR semantics', orRuns.runs.map(function (r) { return [r.m, r.d]; }),
    [[11, 16], [11, 23], [11, 30]]);

  t.eq('weekdayOf known Monday', engine.weekdayOf(2026, 11, 9), 1);
  t.eq('weekdayOf known Sunday', engine.weekdayOf(2026, 11, 8), 0);
  t.eq('invalid start rejected', engine.nextRuns(engine.parseCron('* * * * *'), { y: 2026, m: 13, d: 1, h: 0, min: 0 }),
    { ok: false, error: 'bad_value' });
  t.eq('invalid count rejected', engine.nextRuns(engine.parseCron('* * * * *'), START, 0),
    { ok: false, error: 'bad_count' });
  return '';
});

t.group('engine coverage', function () {
  var total = eg.pass + eg.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
