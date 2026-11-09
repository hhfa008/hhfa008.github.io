'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'url-encoder';
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

  t.eq('encode component spaces and symbols', engine.encodeComponent('a b&c=d 中文+100%').value,
    'a%20b%26c%3Dd%20%E4%B8%AD%E6%96%87%2B100%25');
  t.eq('encode component keeps unreserved', engine.encodeComponent("-_.!~*'()AZaz09").value, "-_.!~*'()AZaz09");
  t.eq('encode component empty', engine.encodeComponent('').value, '');
  t.eq('encode URI keeps structure', engine.encodeUri('https://x.com/a b?q=a&b=c#f').value,
    'https://x.com/a%20b?q=a&b=c#f');
  t.eq('decode component Chinese', engine.decodeComponent('%E4%BD%A0%E5%A5%BD').value, '你好');
  t.eq('decode component plus is space', engine.decodeComponent('x+y').value, 'x y');
  t.eq('decode component encoded plus', engine.decodeComponent('x%2By').value, 'x+y');
  t.eq('decode component round trip', engine.decodeComponent(engine.encodeComponent('a b&c=中文').value).value,
    'a b&c=中文');
  t.eq('decode URI keeps plus literal', engine.decodeUri('a+b').value, 'a+b');
  t.eq('decode URI decodes escapes', engine.decodeUri('https://x.com/a%20b?q=a%26b').value,
    'https://x.com/a b?q=a%26b');

  var badPercent = engine.decodeComponent('%ZZ');
  t.eq('invalid percent error code', badPercent.error, 'bad_percent');
  t.eq('invalid percent position', badPercent.position, 0);
  t.eq('trailing percent position', engine.decodeComponent('abc%').position, 3);
  t.eq('truncated UTF-8 rejected', engine.decodeComponent('%E4%BD').error, 'bad_percent');
  t.eq('decode rejects non-string', engine.decodeComponent(42).error, 'bad_input');
  t.eq('encode rejects non-string', engine.encodeComponent(42).error, 'bad_input');
  t.eq('percentError finds bad sequence', engine.percentError('ok%20fine%G1'), 9);
  t.eq('percentError returns -1 when clean', engine.percentError('a%20b'), -1);

  var parsed = engine.parseQuery('?a=1&a=2&b=x+y&empty=&flag');
  t.ok('parseQuery succeeds', parsed.ok);
  t.eq('parseQuery keeps duplicates', parsed.params.length, 5);
  t.eq('parseQuery duplicate values', [parsed.params[0].value, parsed.params[1].value], ['1', '2']);
  t.eq('parseQuery plus to space', parsed.params[2].value, 'x y');
  t.eq('parseQuery empty value', parsed.params[3].value, '');
  t.eq('parseQuery flag without equals', parsed.params[4], { key: 'flag', value: '' });
  t.eq('parseQuery empty query', engine.parseQuery('').params, []);
  t.eq('parseQuery skips empty segments', engine.parseQuery('a=1&&b=2').params.length, 2);
  t.eq('parseQuery bad percent', engine.parseQuery('a=%ZZ').error, 'bad_percent');

  t.eq('buildQuery basic', engine.buildQuery([{ key: 'a', value: '1' }, { key: 'b', value: '2' }]).value, 'a=1&b=2');
  t.eq('buildQuery encodes spaces as %20',
    engine.buildQuery([{ key: 'q', value: 'coffee beans' }]).value, 'q=coffee%20beans');
  t.eq('buildQuery encodes Chinese and ampersand',
    engine.buildQuery([{ key: 'tag', value: '中文&x' }]).value, 'tag=%E4%B8%AD%E6%96%87%26x');
  t.eq('buildQuery keeps empty key', engine.buildQuery([{ key: '', value: 'v' }]).value, '=v');
  t.eq('buildQuery empty array', engine.buildQuery([]).value, '');
  t.eq('buildQuery rejects non-array', engine.buildQuery('a=1').error, 'bad_input');
  t.eq('buildQuery rejects bad pair', engine.buildQuery([{ value: 'x' }]).error, 'bad_input');
  var roundTrip = engine.parseQuery(engine.buildQuery([{ key: 'a b', value: 'x&y=z' }]).value);
  t.eq('query round trip', roundTrip.params, [{ key: 'a b', value: 'x&y=z' }]);

  var url = engine.parseUrl('https://user:pass@shop.example.com:8443/search?q=coffee+beans&tag=hot&tag=new#results');
  t.ok('parseUrl succeeds', url.ok);
  t.eq('parseUrl protocol', url.protocol, 'https');
  t.eq('parseUrl username', url.username, 'user');
  t.eq('parseUrl password', url.password, 'pass');
  t.eq('parseUrl host', url.host, 'shop.example.com');
  t.eq('parseUrl port', url.port, '8443');
  t.eq('parseUrl path', url.path, '/search');
  t.eq('parseUrl query raw', url.query, 'q=coffee+beans&tag=hot&tag=new');
  t.eq('parseUrl fragment', url.hash, 'results');
  t.eq('parseUrl duplicate params', url.params.length, 3);
  t.eq('parseUrl decodes plus', url.params[0].value, 'coffee beans');

  var protoRelative = engine.parseUrl('//example.com/path');
  t.eq('protocol-relative host', protoRelative.host, 'example.com');
  t.eq('protocol-relative path', protoRelative.path, '/path');
  var relative = engine.parseUrl('/relative?x=1');
  t.eq('relative query', relative.params, [{ key: 'x', value: '1' }]);
  t.eq('relative has no host', relative.host, '');
  t.eq('empty URL rejected', engine.parseUrl('   ').error, 'empty_input');
  t.eq('non-string URL rejected', engine.parseUrl(42).error, 'bad_input');
  t.eq('bad percent in query rejected', engine.parseUrl('https://x.com/?a=%ZZ').error, 'bad_percent');

  var ipv6 = engine.parseUrl('http://[::1]:8080/x?y=1');
  t.eq('IPv6 host', ipv6.host, '[::1]');
  t.eq('IPv6 port', ipv6.port, '8080');
  var noPort = engine.parseUrl('https://example.com:notaport/x');
  t.eq('non-numeric port stays in host', noPort.host, 'example.com:notaport');
  t.eq('non-numeric port is empty', noPort.port, '');
  var emptyQuery = engine.parseUrl('https://x.com/path?');
  t.ok('empty query marks hasQuery', emptyQuery.hasQuery === true);
  t.eq('empty query has no params', emptyQuery.params, []);

  return 'component, URI, query and URL parsing covered';
});

t.group('engine coverage', function () {
  var total = group.pass + group.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
