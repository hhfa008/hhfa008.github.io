#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'lottery-number-generator';
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
  t.ok('entertainment disclaimer is visible', /data-i="disclaimer"/.test(markup));
  return used.length + ' data-i keys, ' + keys.length + ' dictionary keys';
});

t.group('static', function () {
  var refs = lib.externalRefs(html);
  t.eq('externalRefs is empty', refs, []);
  var jsonLd = [];
  try { jsonLd = lib.jsonLd(html); t.ok('JSON-LD parses', true); }
  catch (e) { t.ok('JSON-LD parses', false, e.message); }
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
  var canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  t.ok('canonical correct', !!canonical && canonical[1] === EXPECTED_CANONICAL);
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

  var ticket = engine.drawTicket({ min: 1, max: 49 }, 6, lib.mulberry32(1));
  t.ok('drawTicket returns six numbers', ticket.ok && ticket.numbers.length === 6);
  t.ok('numbers are inside 1..49', ticket.numbers.every(function (n) { return n >= 1 && n <= 49; }));
  t.eq('numbers are unique inside a ticket', new Set(ticket.numbers).size, 6);
  t.ok('numbers are sorted ascending', ticket.numbers.every(function (n, i, arr) { return i === 0 || arr[i - 1] <= n; }));

  t.eq('count above the pool is rejected',
    engine.drawTicket({ min: 1, max: 5 }, 6, lib.mulberry32(1)), { ok: false, error: 'range' });
  t.eq('count 0 is rejected',
    engine.drawTicket({ min: 1, max: 49 }, 0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('min above max is rejected',
    engine.drawTicket({ min: 9, max: 1 }, 2, lib.mulberry32(1)), { ok: false, error: 'range' });
  t.eq('non-object pool is rejected',
    engine.drawTicket(49, 6, lib.mulberry32(1)), { ok: false, error: 'bad_value' });
  t.eq('missing rng is rejected',
    engine.drawTicket({ min: 1, max: 49 }, 6, null), { ok: false, error: 'bad_rng' });
  t.eq('drawTicket is deterministic',
    engine.drawTicket({ min: 1, max: 49 }, 6, lib.mulberry32(42)),
    engine.drawTicket({ min: 1, max: 49 }, 6, lib.mulberry32(42)));

  var batch = engine.generate({
    min: 1, max: 49, count: 6, tickets: 5,
    extraCount: 0, ticketsUnique: true, rng: lib.mulberry32(7)
  });
  t.ok('generate returns five tickets', batch.ok && batch.tickets.length === 5);
  t.ok('every ticket has six unique numbers', batch.tickets.every(function (tk) {
    return tk.numbers.length === 6 && new Set(tk.numbers).size === 6;
  }));

  var withExtra = engine.generate({
    min: 1, max: 35, count: 5, tickets: 3,
    extraCount: 2, extraMin: 1, extraMax: 12, ticketsUnique: true, rng: lib.mulberry32(8)
  });
  t.ok('5/35 + 2 produces two extra numbers per ticket', withExtra.ok &&
    withExtra.tickets.every(function (tk) { return tk.bonus.length === 2; }));
  t.ok('extra numbers stay in 1..12', withExtra.tickets.every(function (tk) {
    return tk.bonus.every(function (n) { return n >= 1 && n <= 12; });
  }));
  t.ok('extra numbers are unique per ticket', withExtra.tickets.every(function (tk) {
    return new Set(tk.bonus).size === tk.bonus.length;
  }));

  t.eq('zero tickets is rejected', engine.generate({
    min: 1, max: 49, count: 6, tickets: 0, extraCount: 0, rng: lib.mulberry32(1)
  }), { ok: false, error: 'bad_tickets' });
  t.eq('more than 50 tickets is rejected', engine.generate({
    min: 1, max: 49, count: 6, tickets: 51, extraCount: 0, rng: lib.mulberry32(1)
  }), { ok: false, error: 'bad_tickets' });
  t.eq('extra count above five is rejected', engine.generate({
    min: 1, max: 49, count: 6, tickets: 1, extraCount: 6, extraMin: 1, extraMax: 12, rng: lib.mulberry32(1)
  }), { ok: false, error: 'bad_extra' });
  t.eq('extra count above its pool is rejected', engine.generate({
    min: 1, max: 49, count: 6, tickets: 1, extraCount: 3, extraMin: 1, extraMax: 2, rng: lib.mulberry32(1)
  }), { ok: false, error: 'bad_extra' });

  var distinct = engine.generate({
    min: 1, max: 10, count: 1, tickets: 10,
    extraCount: 0, ticketsUnique: true, rng: lib.mulberry32(9)
  });
  t.eq('ten distinct single-number tickets cover 1..10',
    distinct.tickets.map(function (tk) { return tk.numbers[0]; }).sort(function (a, b) { return a - b; }),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  t.eq('impossible distinct tickets are rejected', engine.generate({
    min: 1, max: 2, count: 2, tickets: 3,
    extraCount: 0, ticketsUnique: true, rng: lib.mulberry32(1)
  }), { ok: false, error: 'range' });

  t.eq('comb(49, 6) is the documented 6/49 count', engine.comb(49, 6), 13983816);
  t.eq('comb(10, 1) is 10', engine.comb(10, 1), 10);

  var uniqueAcross = true;
  var big = engine.generate({
    min: 1, max: 35, count: 5, tickets: 20,
    extraCount: 2, extraMin: 1, extraMax: 12, ticketsUnique: true, rng: lib.mulberry32(55)
  });
  var sigs = {};
  big.tickets.forEach(function (tk) {
    var sig = tk.numbers.join(',') + '|' + tk.bonus.join(',');
    if (sigs[sig]) uniqueAcross = false;
    sigs[sig] = true;
  });
  t.ok('ticket-level dedupe removes identical tickets', uniqueAcross && Object.keys(sigs).length === 20);

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
