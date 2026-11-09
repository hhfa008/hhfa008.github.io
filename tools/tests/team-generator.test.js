#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'team-generator';
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

  var parsed = engine.parseNames('甲\n\n 乙 \n甲\n丙\n', true);
  t.eq('parseNames trims and drops blank lines', parsed.names, ['甲', '乙', '丙']);
  t.eq('parseNames reports a duplicate', parsed.removed, 1);
  t.eq('parseNames can keep duplicates',
    engine.parseNames('a\na\nb', false).names, ['a', 'a', 'b']);
  t.eq('parseNames rejects a non-string', engine.parseNames(null), { ok: false, error: 'bad_value' });

  var names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  var three = engine.splitTeams(names, 3, lib.mulberry32(1));
  t.ok('splitTeams returns three teams', three.ok && three.teams.length === 3);
  t.eq('10 people in 3 teams become 4, 3, 3', three.sizes, [4, 3, 3]);
  t.eq('team slices preserve every person',
    three.teams.reduce(function (acc, team) { return acc.concat(team); }, []).slice().sort(), names.slice().sort());
  t.ok('no team is empty', three.teams.every(function (team) { return team.length > 0; }));

  var balanced = true;
  for (var n = 1; n <= 30; n++) {
    var list = [];
    for (var q = 0; q < n; q++) list.push('p' + q);
    for (var g = 1; g <= n; g++) {
      var res = engine.splitTeams(list, g, lib.mulberry32(n * 100 + g));
      if (!res.ok) { balanced = false; break; }
      var min = Math.min.apply(null, res.sizes);
      var max = Math.max.apply(null, res.sizes);
      if (max - min > 1) balanced = false;
      var flat = res.teams.reduce(function (acc, team) { return acc.concat(team); }, []);
      if (flat.length !== n || new Set(flat).size !== n) balanced = false;
    }
  }
  t.ok('sizes differ by at most 1 across 465 splits', balanced);

  t.eq('splitTeams is deterministic',
    engine.splitTeams(names, 4, lib.mulberry32(77)).teams,
    engine.splitTeams(names, 4, lib.mulberry32(77)).teams);

  t.eq('more teams than people is rejected',
    engine.splitTeams(['a', 'b'], 3, lib.mulberry32(1)), { ok: false, error: 'range' });
  t.eq('empty names are rejected',
    engine.splitTeams([], 1, lib.mulberry32(1)), { ok: false, error: 'empty_input' });
  t.eq('zero teams are rejected',
    engine.splitTeams(names, 0, lib.mulberry32(1)), { ok: false, error: 'bad_groups' });
  t.eq('fractional teams are rejected',
    engine.splitTeams(names, 2.5, lib.mulberry32(1)), { ok: false, error: 'bad_groups' });
  t.eq('non-array names are rejected',
    engine.splitTeams('abc', 2, lib.mulberry32(1)), { ok: false, error: 'bad_value' });
  t.eq('missing rng is rejected',
    engine.splitTeams(names, 2, null), { ok: false, error: 'bad_rng' });

  var one = engine.splitTeams(['solo'], 1, lib.mulberry32(1));
  t.eq('one person and one team works', one.teams, [['solo']]);
  var all = engine.splitTeams(names, 1, lib.mulberry32(2));
  t.eq('one team holds everyone', all.teams[0].length, 10);

  var bySize = engine.splitBySize(names, 4, lib.mulberry32(5));
  t.eq('10 people with target 4 become 3 teams', bySize.teams.length, 3);
  t.ok('no team exceeds the target size', bySize.sizes.every(function (s) { return s <= 4; }));
  var bySize3 = engine.splitBySize(names, 3, lib.mulberry32(6));
  t.eq('10 people with target 3 become 4 teams', bySize3.teams.length, 4);
  t.ok('target-size split stays within one person',
    Math.max.apply(null, bySize3.sizes) - Math.min.apply(null, bySize3.sizes) <= 1);
  t.eq('target size above everyone gives one team',
    engine.splitBySize(names, 20, lib.mulberry32(7)).teams.length, 1);
  t.eq('zero target size is rejected',
    engine.splitBySize(names, 0, lib.mulberry32(1)), { ok: false, error: 'bad_size' });

  var sh = engine.shuffle(names, lib.mulberry32(11));
  t.ok('shuffle is a permutation',
    sh.items.slice().sort().join(',') === names.slice().sort().join(','));
  t.eq('shuffle is reproducible', engine.shuffle(names, lib.mulberry32(11)).items, sh.items);
  t.eq('shuffle rejects a non-array', engine.shuffle('abc', lib.mulberry32(1)), { ok: false, error: 'bad_value' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
