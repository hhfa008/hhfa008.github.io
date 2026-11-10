'use strict';

// screen-share-calc is a legacy static four-language page (no ToolEngine).
// These assertions cover the static contract: per-language documents, SEO
// metadata, JSON-LD, offline safety, dark-mode / reduced-motion support and
// the dark-mode CTA contrast fix.

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'screen-share-calc';
var ROOT = path.join('/Users/fa/games/tools', SLUG);
var MAX_BYTES = 90 * 1024;
var BASE = 'https://hhfa008.github.io/tools/' + SLUG + '/';
var LANGS = ['en', 'id', 'vi', 'th'];
var FILES = {
  en: 'index.html',
  id: 'id/index.html',
  vi: 'vi/index.html',
  th: 'th/index.html'
};
var LANG_TAG = { en: 'en', id: 'id', vi: 'vi', th: 'th' };

var t = lib.suite(SLUG);
var pages = {};

t.group('files', function () {
  LANGS.forEach(function (lang) {
    var file = path.join(ROOT, FILES[lang]);
    var exists = fs.existsSync(file);
    t.ok(lang + ' page exists', exists, file);
    if (!exists) return;
    var html = fs.readFileSync(file, 'utf8');
    pages[lang] = html;
    t.ok(lang + ' page non-empty', html.length > 1000, html.length + ' chars');
    t.ok(lang + ' page <= 90 KB', Buffer.byteLength(html, 'utf8') <= MAX_BYTES,
      (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1) + ' KB');
  });
  return Object.keys(pages).join(', ');
});

t.group('document', function () {
  LANGS.forEach(function (lang) {
    var html = pages[lang];
    if (!html) return;
    var tag = '[' + lang + '] ';
    t.ok(tag + 'html lang correct', new RegExp('<html[^>]*lang="' + LANG_TAG[lang] + '"').test(html));
    t.ok(tag + 'viewport present', /<meta[^>]*name="viewport"[^>]*width=device-width/i.test(html));
    t.ok(tag + 'title non-empty', /<title>[^<]*\S[^<]*<\/title>/i.test(html));
    t.ok(tag + 'meta description non-empty',
      /<meta[^>]*name="description"[^>]*content="[^"]+\S[^"]*"/i.test(html));
    var canonical = lang === 'en' ? BASE : BASE + lang + '/';
    t.ok(tag + 'canonical correct',
      html.indexOf('rel="canonical" href="' + canonical + '"') !== -1, canonical);
    var hreflangs = ['en', 'id', 'vi', 'th', 'x-default'];
    hreflangs.forEach(function (h) {
      t.ok(tag + 'hreflang ' + h + ' present',
        new RegExp('rel="alternate" hreflang="' + h + '"').test(html));
    });
    t.eq(tag + 'externalRefs empty', lib.externalRefs(html), []);
    t.ok(tag + 'dark mode media query', /prefers-color-scheme\s*:\s*dark/.test(html));
    t.ok(tag + 'reduced motion media query', /prefers-reduced-motion\s*:\s*reduce/.test(html));
    t.ok(tag + 'no placeholder text',
      !/\b(TODO|FIXME|lorem ipsum|placeholder text)\b/i.test(html));
  });
});

t.group('json-ld', function () {
  LANGS.forEach(function (lang) {
    var html = pages[lang];
    if (!html) return;
    var jsonLd;
    try {
      jsonLd = lib.jsonLd(html);
      t.ok('[' + lang + '] JSON-LD parses', true);
    } catch (e) {
      t.ok('[' + lang + '] JSON-LD parses', false, e.message);
      return;
    }
    t.eq('[' + lang + '] JSON-LD block count', jsonLd.length, 3);
    t.eq('[' + lang + '] JSON-LD types',
      jsonLd.map(function (x) { return x && x['@type']; }).sort(),
      ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
    var faq = jsonLd.filter(function (x) { return x && x['@type'] === 'FAQPage'; })[0];
    t.ok('[' + lang + '] FAQ has >= 3 questions',
      !!(faq && faq.mainEntity && faq.mainEntity.length >= 3));
  });
});

t.group('contrast and routing', function () {
  LANGS.forEach(function (lang) {
    var html = pages[lang];
    if (!html) return;
    // The CTA is `.btn` with a white label on the light dark-mode accent; in
    // dark mode the label must flip to the near-black ink to reach 4.5:1.
    var dark = html.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^}]*\.btn[^}]*\}/);
    t.ok('[' + lang + '] dark-mode .btn color override present', !!dark,
      dark ? dark[0].replace(/\s+/g, ' ').slice(0, 80) : 'missing');
    t.ok('[' + lang + '] dark-mode .btn uses dark ink',
      !!dark && /#14171a/i.test(dark[0]));
  });
  var root = pages.en || '';
  t.ok('root ?lang routing script present', /data-lang-fallback="1"/.test(root));
  t.ok('root routes id/vi/th to their localized pages',
    /lang\s*===\s*'id'\s*\|\|\s*lang\s*===\s*'vi'\s*\|\|\s*lang\s*===\s*'th'/.test(root));
  t.ok('root declares zh fallback language tag', /zh-CN/.test(root));
});

t.done();
