#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'speed-distance-time-calculator';
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
  t.eq('externalRefs is empty', lib.externalRefs(html), []);

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
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  t.eq('parse 1:30', engine.parseDuration('1:30').totalSeconds, 5400);
  t.eq('parse 1:02:03', engine.parseDuration('1:02:03').totalSeconds, 3723);
  t.eq('parse 90m', engine.parseDuration('90m').totalSeconds, 5400);
  t.eq('parse 5400s', engine.parseDuration('5400s').totalSeconds, 5400);
  t.eq('parse 2h', engine.parseDuration('2h').totalSeconds, 7200);
  t.eq('parse 1h30m', engine.parseDuration('1h30m').totalSeconds, 5400);
  t.eq('parse bare number as hours', engine.parseDuration('2').totalSeconds, 7200);
  t.eq('parse 1:75 rejects', engine.parseDuration('1:75'), { ok: false, error: 'bad_time' });
  t.eq('parse 1:02:75 rejects', engine.parseDuration('1:02:75'), { ok: false, error: 'bad_time' });
  t.eq('parse empty rejects', engine.parseDuration(''), { ok: false, error: 'empty_input' });
  t.eq('parse garbage rejects', engine.parseDuration('abc'), { ok: false, error: 'bad_value' });
  t.eq('parse negative rejects', engine.parseDuration('-5m'), { ok: false, error: 'bad_value' });

  t.eq('format 3661', engine.formatDuration(3661).text, '1:01:01');
  t.eq('format 5400', engine.formatDuration(5400).text, '1:30:00');
  t.eq('format zero', engine.formatDuration(0).text, '0:00:00');
  t.eq('format rejects negative', engine.formatDuration(-1).error, 'bad_value');

  var speed = engine.solveSDT({ solve: 'speed', distance: 100, distanceUnit: 'km', timeSeconds: 7200 });
  t.ok('solve speed ok', speed.ok === true);
  t.near('100 km / 2 h in km/h', speed.speed.kmh, 50, 1e-9);
  t.near('100 km / 2 h in m/s', speed.speed.ms, 100000 / 7200, 1e-9);
  t.eq('duration text', speed.duration.text, '2:00:00');

  var dist = engine.solveSDT({ solve: 'distance', speed: 50, speedUnit: 'kmh', timeSeconds: 7200 });
  t.near('50 km/h for 2 h gives 100 km', dist.distance.km, 100, 1e-9);
  t.near('50 km/h for 2 h in miles', dist.distance.mi, 100 / 1.609344, 1e-9);

  var time = engine.solveSDT({ solve: 'time', distance: 150, distanceUnit: 'km', speed: 50, speedUnit: 'kmh' });
  t.near('150 km at 50 km/h takes 10800 s', time.timeSec, 10800, 1e-9);
  t.eq('time duration text', time.duration.text, '3:00:00');

  t.near('10 m/s = 36 km/h', engine.mpsToSpeed(engine.speedToMps(10, 'ms').value, 'kmh').value, 36, 1e-9);
  t.near('60 mph = 96.56064 km/h', engine.mpsToSpeed(engine.speedToMps(60, 'mph').value, 'kmh').value, 96.56064, 1e-9);
  t.near('1 knot = 1.852 km/h', engine.mpsToSpeed(engine.speedToMps(1, 'knot').value, 'kmh').value, 1.852, 1e-9);
  t.near('1 mile = 1609.344 m', engine.toMeters(1, 'mi').value, 1609.344, 1e-12);
  t.near('1 nmi = 1852 m', engine.toMeters(1, 'nmi').value, 1852, 1e-12);

  t.eq('zero time rejected', engine.solveSDT({ solve: 'speed', distance: 10, distanceUnit: 'km', timeSeconds: 0 }).error, 'zero_time');
  t.eq('zero speed rejected for time', engine.solveSDT({ solve: 'time', distance: 10, distanceUnit: 'km', speed: 0, speedUnit: 'kmh' }).error, 'zero_speed');
  t.eq('negative distance rejected', engine.solveSDT({ solve: 'speed', distance: -10, distanceUnit: 'km', timeSeconds: 60 }).error, 'bad_value');
  t.eq('bad distance unit rejected', engine.solveSDT({ solve: 'speed', distance: 1, distanceUnit: 'lightyear', timeSeconds: 60 }).error, 'bad_unit');
  t.eq('bad speed unit rejected', engine.solveSDT({ solve: 'time', distance: 1, distanceUnit: 'km', speed: 1, speedUnit: 'warp' }).error, 'bad_unit');
  t.eq('bad mode rejected', engine.solveSDT({ solve: 'mass', distance: 1 }).error, 'bad_mode');

  t.eq('round 1.005 to 2', engine.round(1.005, 2), { ok: true, value: 1.01 });
  t.eq('round -2.5 to 0', engine.round(-2.5, 0), { ok: true, value: -3 });
  t.eq('round rejects 7 decimals', engine.round(1, 7), { ok: false, error: 'bad_decimals' });
  t.eq('isNum(0)', engine.isNum(0), true);
  t.eq('isNum("0")', engine.isNum('0'), false);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
