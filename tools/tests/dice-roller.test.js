#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'dice-roller';
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

  var sides = engine.SIDES;
  t.eq('supported faces are d4..d100', sides.slice(), [4, 6, 8, 10, 12, 20, 100]);

  var one = engine.rollDice(6, 1, 0, lib.mulberry32(1));
  t.ok('single d6 returns one face', one.ok && one.rolls.length === 1 && one.rolls[0] >= 1 && one.rolls[0] <= 6);
  t.eq('single d6 total equals the face', one.ok && one.total, one.rolls[0]);

  var three = engine.rollDice(20, 3, 2, lib.mulberry32(2));
  t.ok('three d20 return three faces', three.ok && three.rolls.length === 3);
  t.ok('every d20 face stays in 1..20', three.rolls.every(function (v) { return v >= 1 && v <= 20; }));
  t.eq('modifier is added to the sum', three.total, three.sum + 2);
  t.eq('sum equals the rolled faces', three.sum, three.rolls.reduce(function (a, b) { return a + b; }, 0));

  t.eq('rollDice is deterministic for the same rng',
    engine.rollDice(12, 4, -1, lib.mulberry32(9)), engine.rollDice(12, 4, -1, lib.mulberry32(9)));

  t.eq('unsupported d7 is rejected', engine.rollDice(7, 1, 0, lib.mulberry32(1)), { ok: false, error: 'unsupported' });
  t.eq('d0 is rejected', engine.rollDice(0, 1, 0, lib.mulberry32(1)), { ok: false, error: 'unsupported' });
  t.eq('string faces are rejected', engine.rollDice('6', 1, 0, lib.mulberry32(1)), { ok: false, error: 'unsupported' });
  t.eq('count 0 is rejected', engine.rollDice(6, 0, 0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('negative count is rejected', engine.rollDice(6, -2, 0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('fractional count is rejected', engine.rollDice(6, 1.5, 0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('count over 100 is rejected', engine.rollDice(6, 101, 0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('fractional modifier is rejected', engine.rollDice(6, 1, 1.5, lib.mulberry32(1)), { ok: false, error: 'bad_mod' });
  t.eq('modifier over 100 is rejected', engine.rollDice(6, 1, 101, lib.mulberry32(1)), { ok: false, error: 'bad_mod' });
  t.eq('missing rng is rejected', engine.rollDice(6, 1, 0, null), { ok: false, error: 'bad_rng' });

  var hundred = engine.rollDice(6, 100, 0, lib.mulberry32(10));
  t.ok('100 dice are allowed', hundred.ok && hundred.rolls.length === 100);
  var invariant = true;
  for (var i = 0; i < 200; i++) {
    var r = engine.rollDice(sides[i % sides.length], (i % 20) + 1, (i % 9) - 4, lib.mulberry32(i + 1));
    var faceSum = r.rolls.reduce(function (a, b) { return a + b; }, 0);
    if (r.sum !== faceSum || r.total !== faceSum + r.mod) invariant = false;
  }
  t.ok('sum and total invariants hold across 200 rolls', invariant);

  var d100range = true;
  var rr = lib.mulberry32(555);
  for (var j = 0; j < 300; j++) {
    var v = engine.rollDice(100, 1, 0, rr);
    if (v.rolls[0] < 1 || v.rolls[0] > 100) d100range = false;
  }
  t.ok('d100 stays in 1..100 over 300 rolls', d100range);

  var critOk = true;
  for (var s = 0; s < 300; s++) {
    var cr = engine.rollDice(20, 1, 0, lib.mulberry32(s));
    if (cr.crit !== (cr.rolls[0] === 20)) critOk = false;
    if (cr.fumble !== (cr.rolls[0] === 1)) critOk = false;
  }
  t.ok('d20 crit and fumble flags match natural rolls', critOk);

  var d6roll = engine.rollDice(6, 1, 0, lib.mulberry32(4));
  t.ok('d6 never reports a critical', d6roll.crit === false && d6roll.fumble === false);

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
