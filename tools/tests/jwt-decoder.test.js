#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'jwt-decoder';
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

function b64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}
function token(header, payload, sig) {
  return b64(header) + '.' + b64(payload) + '.' + (sig == null ? 'c2ln' : sig);
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
  t.ok('security warning present in html', /不验证签名|does not verify|tidak memverifikasi/i.test(html));
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
  t.eq('b64url decodes UTF-8', engine.b64urlDecode('5Lit5paH'), { ok: true, bytes: [0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87], text: '中文' });
  t.eq('b64url accepts padding', engine.b64urlDecode('5Lit5paH==').text, '中文');
  t.eq('b64url rejects bad char', engine.b64urlDecode('ab$c'), { ok: false, error: 'bad_segment' });
  t.eq('b64url rejects non-string', engine.b64urlDecode(null), { ok: false, error: 'bad_value' });
  t.ok('decodePart parses JSON', (function () {
    var r = engine.decodePart(b64({ a: 1, b: '中' }));
    return r.ok && r.value.a === 1 && r.value.b === '中';
  })(), 'UTF-8 JSON');
  t.eq('decodePart rejects non-JSON', engine.decodePart('bm90IGpzb24'), { ok: false, error: 'bad_json' });
  t.eq('decodeJwt rejects two segments', engine.decodeJwt('a.b'), { ok: false, error: 'bad_parts' });
  t.eq('decodeJwt rejects four segments', engine.decodeJwt('a.b.c.d'), { ok: false, error: 'bad_parts' });
  t.eq('decodeJwt rejects empty header', engine.decodeJwt('.e30.c2ln'), { ok: false, error: 'bad_segment' });
  t.eq('decodeJwt rejects bad signature chars', engine.decodeJwt(b64({ alg: 'none' }) + '.' + b64({}) + '.a$b'), { ok: false, error: 'bad_segment' });
  t.eq('decodeJwt empty input', engine.decodeJwt('   '), { ok: false, error: 'empty_input' });
  t.ok('decodeJwt accepts empty signature', (function () {
    var r = engine.decodeJwt(b64({ alg: 'none' }) + '.' + b64({ sub: 'x' }) + '.');
    return r.ok && r.signature === '' && r.signed === false;
  })(), 'alg none');
  t.ok('decodeJwt returns both parts', (function () {
    var r = engine.decodeJwt(token({ alg: 'HS256', typ: 'JWT' }, { sub: '42', admin: false }, 'sig'));
    return r.ok && r.header.alg === 'HS256' && r.payload.sub === '42' && r.payload.admin === false;
  })(), 'header + payload');
  t.ok('signature is not verified', engine.decodeJwt(token({ alg: 'HS256' }, { sub: 'x' }, 'dGFtcGVyZWQ')).ok, 'tampered signature still decodes');
  t.eq('exp equal to now is expired', engine.claimsStatus({ exp: 1000 }, 1000).exp.state, 'expired');
  t.eq('exp in the future is valid', engine.claimsStatus({ exp: 1001 }, 1000).exp.state, 'valid');
  t.eq('exp in the past makes status expired', engine.claimsStatus({ exp: 999 }, 1000).status, 'expired');
  t.eq('nbf in the future blocks token', engine.claimsStatus({ nbf: 1001 }, 1000).status, 'not_yet_valid');
  t.eq('iat in the future is flagged', engine.claimsStatus({ iat: 1001 }, 1000).iat.state, 'in_future');
  t.eq('no time claims state', engine.claimsStatus({ sub: 'x' }, 1000).status, 'no_time_claims');
  t.eq('missing claims are reported', engine.claimsStatus({ exp: 999 }, 1000).nbf.state, 'missing');
  t.eq('non-numeric exp is invalid', engine.claimsStatus({ exp: 'tomorrow' }, 1000).exp.state, 'invalid');
  t.eq('claimsStatus rejects bad payload', engine.claimsStatus(null, 1000), { ok: false, error: 'bad_value' });
  t.eq('claimsStatus rejects bad clock', engine.claimsStatus({}, NaN), { ok: false, error: 'bad_value' });
  return '';
});

t.group('engine coverage', function () {
  var total = eg.pass + eg.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
