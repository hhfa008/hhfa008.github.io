#!/usr/bin/env node
'use strict';

/*
 * Delivery gate for the whole tools catalog.
 *
 *   node tools/tests/catalog-integrity.test.js
 *
 * Checks, from static files only:
 *   - tools/tests/catalog.json: 100 entries, unique slugs, category counts.
 *   - Every slug has tools/<slug>/index.html and tools/tests/<slug>.test.js.
 *     Both former pre-contract exceptions now have their own test, so the
 *     missing-test whitelist is empty (kept as an explicitly empty map).
 *   - No page still carries <!--TOOL_BODY--> / <!--TOOL_EXPLAIN--> /
 *     "TODO: builder" / the scaffold's empty `return {};` ToolEngine.
 *   - Page size: 90KB default; 120KB for the six media-heavy pages.
 *   - zh/en/id dictionaries exist and expose identical key sets. Two accepted
 *     stock pages keep their pre-contract structure instead and are checked
 *     against it: screen-share-calc (static id/th/vi directories) and
 *     sari-sari-ledger (inline `var I18N` en/zh/id/fil); the exception is
 *     printed.
 *   - The three hall pages have 100 cards and an ItemList whose
 *     numberOfItems / itemListElement length is also 100.
 *
 * Prints the shared suite RESULT line and exits 1 on any failure.
 * run-all.js discovers this file automatically (tools/tests/*.test.js).
 */

var fs = require('fs');
var path = require('path');
var lib = require('./lib.js');
var makeTool = require('./scaffold/make-tool.js');

var TESTS_DIR = __dirname;
var TOOLS_ROOT = path.resolve(TESTS_DIR, '..');
var CATALOG_PATH = path.join(TESTS_DIR, 'catalog.json');

var EXPECTED_COUNTS = {
  'calc-finance': 21,
  'text-dev': 24,
  'design-image': 12,
  'date-time': 8,
  'math': 10,
  'health': 9,
  'life-home': 7,
  'random-fun': 8,
  ledger: 1
};

var MAX_PAGE_BYTES = 90 * 1024;
// Media-heavy pages: QR/barcode rendering and image conversion/pipelines.
var BIG_PAGE_BYTES = 120 * 1024;
var BIG_PAGE_SLUGS = {
  'qr-code-generator': 1,
  'barcode-generator': 1,
  'image-compressor': 1,
  'image-resizer': 1,
  'image-to-base64': 1,
  'image-rotate': 1
};

// Pre-contract stock pages. They were allowed to lack the new per-tool test
// file; both now have one, so nothing is whitelisted. Every other contract
// check (placeholders, size, i18n) still applies.
var LEGACY_NO_TEST = {};

// Accepted legacy language structures (verified on the live pages):
//   - screen-share-calc: one static directory per language.
//   - sari-sari-ledger: inline `var I18N = { en, zh, id, fil }` dictionary.
// They are skipped by the strict <script id="i18n"> extractor, but their own
// agreed-upon structure is asserted instead, and the exception is reported.
var LEGACY_I18N = {
  'screen-share-calc': {
    kind: 'multidir',
    dirs: [
      { file: 'index.html', lang: 'en' },
      { file: 'id/index.html', lang: 'id' },
      { file: 'th/index.html', lang: 'th' },
      { file: 'vi/index.html', lang: 'vi' }
    ]
  },
  'sari-sari-ledger': {
    kind: 'varI18N',
    langs: ['en', 'zh', 'id', 'fil']
  }
};

var HALLS = [
  { file: 'index.html', lang: 'zh-CN' },
  { file: 'en/index.html', lang: 'en' },
  { file: 'id/index.html', lang: 'id' }
];

var t = lib.suite('catalog integrity');

var catalog = [];
var catalogError = null;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
} catch (e) {
  catalogError = e;
}

var slugs = [];
if (Array.isArray(catalog)) {
  slugs = catalog.map(function (item) { return item && item.slug; });
}

function pagePath(slug) {
  return path.join(TOOLS_ROOT, slug, 'index.html');
}

function readPage(slug) {
  try { return fs.readFileSync(pagePath(slug), 'utf8'); }
  catch (e) { return null; }
}

function first(html, re) {
  var m = html.match(re);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 1. catalog.json
// ---------------------------------------------------------------------------

t.group('catalog.json 结构与分类计数', function () {
  t.ok('catalog.json 可解析', !catalogError, catalogError && catalogError.message);
  t.ok('catalog 是数组', Array.isArray(catalog), '实际 ' + typeof catalog);
  if (!Array.isArray(catalog)) return '';
  t.eq('条目数 = 100', catalog.length, 100);
  t.eq('slug 唯一', new Set(slugs).size, slugs.length);

  var badEntry = [];
  catalog.forEach(function (item, i) {
    if (!item || typeof item.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) {
      badEntry.push('[' + i + '] slug=' + JSON.stringify(item && item.slug));
    }
  });
  t.eq('slug 格式合法', badEntry, []);

  var counts = {};
  catalog.forEach(function (item) {
    if (!item || !item.category) return;
    counts[item.category] = (counts[item.category] || 0) + 1;
  });
  Object.keys(EXPECTED_COUNTS).forEach(function (cat) {
    t.eq('分类 ' + cat + ' = ' + EXPECTED_COUNTS[cat],
      counts[cat] || 0, EXPECTED_COUNTS[cat]);
  });
  t.eq('没有未知分类', Object.keys(counts).sort(), Object.keys(EXPECTED_COUNTS).sort());
  return Object.keys(EXPECTED_COUNTS).map(function (cat) {
    return cat + ':' + EXPECTED_COUNTS[cat];
  }).join(', ');
});

// ---------------------------------------------------------------------------
// 2. page + test file coverage
// ---------------------------------------------------------------------------

t.group('页面与测试文件覆盖', function () {
  if (!slugs.length) return '跳过：catalog 为空';
  var missingPages = [];
  var missingTests = [];
  var legacyHits = [];

  slugs.forEach(function (slug) {
    if (!fs.existsSync(pagePath(slug))) missingPages.push(slug);
    var testFile = path.join(TESTS_DIR, slug + '.test.js');
    if (!fs.existsSync(testFile)) {
      if (LEGACY_NO_TEST[slug]) legacyHits.push(slug);
      else missingTests.push(slug);
    }
  });

  t.eq('每个 slug 都有 tools/<slug>/index.html', missingPages, []);
  t.eq('每个 slug 都有 tools/tests/<slug>.test.js（白名单除外）', missingTests, []);
  Object.keys(LEGACY_NO_TEST).forEach(function (slug) {
    t.ok('缺测试白名单 ' + slug + ' 属于 catalog', slugs.indexOf(slug) !== -1);
    t.ok('缺测试白名单 ' + slug + ' 当前确实缺测试',
      !fs.existsSync(path.join(TESTS_DIR, slug + '.test.js')));
  });
  return '缺测试白名单: ' + legacyHits.map(function (slug) {
    return slug + '（' + LEGACY_NO_TEST[slug] + '）';
  }).join('; ');
});

// ---------------------------------------------------------------------------
// 3. placeholders + file size
// ---------------------------------------------------------------------------

t.group('占位符与文件体积', function () {
  if (!slugs.length) return '跳过：catalog 为空';
  var placeholders = [];
  var oversize = [];
  var bigUsed = [];

  slugs.forEach(function (slug) {
    var html = readPage(slug);
    if (html == null) return;
    var issues = makeTool.placeholderIssues(html);
    if (issues.length) placeholders.push(slug + ': ' + issues.join(' | '));

    var bytes = Buffer.byteLength(html, 'utf8');
    var limit = BIG_PAGE_SLUGS[slug] ? BIG_PAGE_BYTES : MAX_PAGE_BYTES;
    if (BIG_PAGE_SLUGS[slug] && bytes > MAX_PAGE_BYTES) bigUsed.push(slug);
    if (bytes > limit) {
      oversize.push(slug + ' ' + (bytes / 1024).toFixed(1) + 'KB > ' +
        (limit / 1024).toFixed(0) + 'KB');
    }
  });

  t.eq('无 <!--TOOL_BODY-->/<!--TOOL_EXPLAIN-->/TODO: builder/空 ToolEngine',
    placeholders, []);
  t.eq('文件体积在限值内', oversize, []);
  return '上限 90KB；120KB 白名单: ' + Object.keys(BIG_PAGE_SLUGS).join(', ') +
    (bigUsed.length ? '（实际超过 90KB: ' + bigUsed.join(', ') + '）' : '');
});

// ---------------------------------------------------------------------------
// 4. three-language dictionaries
// ---------------------------------------------------------------------------

t.group('zh/en/id 三语字典', function () {
  if (!slugs.length) return '跳过：catalog 为空';
  var issues = [];
  var hadDict = 0;
  var legacyChecked = [];

  slugs.forEach(function (slug) {
    var html = readPage(slug);
    if (html == null) return;

    var legacy = LEGACY_I18N[slug];
    if (legacy) {
      legacyChecked.push(slug);
      if (legacy.kind === 'multidir') {
        legacy.dirs.forEach(function (entry) {
          var file = path.join(TOOLS_ROOT, slug, entry.file);
          var legacyHtml = null;
          try { legacyHtml = fs.readFileSync(file, 'utf8'); } catch (e) { /* asserted below */ }
          t.ok('存量 ' + slug + '/' + entry.file + ' 存在', legacyHtml != null);
          if (legacyHtml == null) return;
          t.eq('存量 ' + slug + '/' + entry.file + ' html lang',
            first(legacyHtml, /<html[^>]*\blang\s*=\s*["']([^"']+)["']/i), entry.lang);
        });
      } else if (legacy.kind === 'varI18N') {
        var m = html.match(/var I18N = (\{[\s\S]*?\n  \});/);
        t.ok('存量 ' + slug + ' 有 var I18N 字典', !!m);
        if (!m) return;
        var legacyDict = null;
        try { legacyDict = lib.evalCode(m[0], 'I18N'); }
        catch (e) {
          t.ok('存量 ' + slug + ' I18N 可求值', false, e.message);
          return;
        }
        var baseKeys = Object.keys(legacyDict[legacy.langs[0]] || {}).sort();
        legacy.langs.forEach(function (lang) {
          t.ok('存量 ' + slug + ' 有语言 ' + lang, !!legacyDict[lang]);
          t.eq('存量 ' + slug + ' ' + lang + ' 键与 ' + legacy.langs[0] + ' 一致',
            Object.keys(legacyDict[lang] || {}).sort(), baseKeys);
        });
      }
      return;
    }

    var code;
    try {
      code = lib.scriptCode(html, 'i18n');
    } catch (e) {
      issues.push(slug + ': 缺少 <script id="i18n">');
      return;
    }
    var dict;
    try {
      dict = lib.evalCode(code, 'TOOL_I18N');
    } catch (e) {
      issues.push(slug + ': 字典无法求值 (' + e.message + ')');
      return;
    }
    if (!dict || !dict.zh || !dict.en || !dict.id) {
      issues.push(slug + ': 缺少 zh/en/id 之一');
      return;
    }
    hadDict++;
    var base = Object.keys(dict.zh).sort();
    ['en', 'id'].forEach(function (lang) {
      var keys = Object.keys(dict[lang]).sort();
      if (JSON.stringify(keys) !== JSON.stringify(base)) {
        var onlyBase = base.filter(function (k) { return keys.indexOf(k) === -1; });
        var onlyLang = keys.filter(function (k) { return base.indexOf(k) === -1; });
        issues.push(slug + ': ' + lang + ' 键与 zh 不一致' +
          (onlyBase.length ? '，缺 ' + onlyBase.slice(0, 4).join(',') : '') +
          (onlyLang.length ? '，多 ' + onlyLang.slice(0, 4).join(',') : ''));
      }
    });
  });

  t.eq('每个页面都有 zh/en/id 且键一致（存量例外见说明）', issues, []);
  return hadDict + '/100 页使用新契约 #i18n；存量例外: ' + legacyChecked.map(function (slug) {
    return slug + '（' + (LEGACY_I18N[slug].kind === 'multidir'
      ? '多目录 id/th/vi'
      : 'var I18N en/zh/id/fil') + '）';
  }).join('; ');
});

// ---------------------------------------------------------------------------
// 5. hall pages
// ---------------------------------------------------------------------------

t.group('大厅三页：卡片数与 ItemList', function () {
  var expectedCards = Array.isArray(catalog) ? catalog.length : 100;

  HALLS.forEach(function (hall) {
    var file = path.join(TOOLS_ROOT, hall.file);
    var html = null;
    try { html = fs.readFileSync(file, 'utf8'); } catch (e) { /* handled below */ }
    var label = 'tools/' + hall.file;
    t.ok(label + ' 存在', html != null, file);
    if (html == null) return;

    t.eq(label + ' html lang = ' + hall.lang,
      first(html, /<html[^>]*\blang\s*=\s*["']([^"']+)["']/i), hall.lang);

    var cards = (html.match(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\btool-card\b/gi) || []).length;
    t.eq(label + ' .tool-card 数 = ' + expectedCards, cards, expectedCards);

    var blocks = [];
    try { blocks = lib.jsonLd(html); }
    catch (e) { t.ok(label + ' JSON-LD 可解析', false, e.message); return; }

    var list = null;
    blocks.forEach(function (block) {
      if (!block) return;
      if (block['@type'] === 'CollectionPage' && block.mainEntity &&
          block.mainEntity['@type'] === 'ItemList') {
        list = block.mainEntity;
      } else if (block['@type'] === 'ItemList') {
        list = block;
      }
    });
    t.ok(label + ' 有 ItemList', !!list);
    if (!list) return;
    t.eq(label + ' ItemList.numberOfItems', list.numberOfItems, expectedCards);
    t.eq(label + ' itemListElement 长度',
      Array.isArray(list.itemListElement) ? list.itemListElement.length : null,
      expectedCards);
  });

  return '三页 cards = ItemList = numberOfItems = ' + expectedCards;
});

t.done();
